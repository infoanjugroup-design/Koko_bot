'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

type ChatMode = 'NORMAL' | 'AWAITING_LOGIN' | 'AWAITING_REGISTER';

interface Message {
  sender: 'user' | 'bot';
  text: string;
  options?: string[]; // Quick action buttons
}

export default function KokoChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'bot',
      text: 'Namaste! Welcome to Koko Foods. Koi sawal ya coupon code ho toh yahan likhein.',
    },
  ]);
  const [input, setInput] = useState('');
  const [currentMode, setCurrentMode] = useState<ChatMode>('NORMAL');
  const [scannedCode, setScannedCode] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const hasTriggeredRef = useRef(false);

  // Message Handler & State Machine Logic
  const handleSend = (customText?: string) => {
    const query = (customText !== undefined ? customText : input).trim();
    if (!query) return;

    // 1. User message chat UI mein add karein
    setMessages((prev) => [...prev, { sender: 'user', text: query }]);
    setInput('');

    const cleanUpper = query.toUpperCase();

    // 2. Action Routing
    setTimeout(() => {
      // CASE 1: User ne "LOGIN" button click kiya ya text bheja
      if (cleanUpper === 'LOGIN' || cleanUpper.includes('LOGIN')) {
        setCurrentMode('AWAITING_LOGIN');
        setMessages((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: '🔐 Kripya apna registered **Email / Phone** aur **Password** enter karein:\n(Format: user@example.com, password123)',
          },
        ]);
        return;
      }

      // CASE 2: User ne "REGISTER" button click kiya ya text bheja
      if (cleanUpper === 'REGISTER' || cleanUpper.includes('REGISTER')) {
        setCurrentMode('AWAITING_REGISTER');
        setMessages((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: '📝 Registration ke liye apna **Name, Email/Phone, Password** enter karein:\n(Format: Rahul, rahul@example.com, pass123)',
          },
        ]);
        return;
      }

      // CASE 3: User ne Login Details submit ki
      if (currentMode === 'AWAITING_LOGIN') {
        setCurrentMode('NORMAL');
        if (scannedCode) {
          setMessages((prev) => [
            ...prev,
            {
              sender: 'bot',
              text: `✅ *Login Successful!*\n\n🎉 Aapka pehle se scan kiya hua code (**${scannedCode}**) automatically verify ho gaya hai aur 50 KOKO Coins aapke wallet mein add ho gaye hain! 🍿`,
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              sender: 'bot',
              text: '✅ *Login Successful!*\nAap login ho chuke hain. Koi coupon code ho toh enter karein.',
            },
          ]);
        }
        return;
      }

      // CASE 4: User ne Register Details submit ki
      if (currentMode === 'AWAITING_REGISTER') {
        setCurrentMode('NORMAL');
        if (scannedCode) {
          setMessages((prev) => [
            ...prev,
            {
              sender: 'bot',
              text: `🎉 *Account Created Successfully!*\n\nAapka welcome bonus aur code (**${scannedCode}**) ke 50 Coins credit kar diye gaye hain!`,
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              sender: 'bot',
              text: '🎉 *Account Created Successfully!*\nWelcome to Koko Foods! Ab aap shopping start kar sakte hain.',
            },
          ]);
        }
        return;
      }

      // CASE 5: User ne "SKIP" likha
      if (cleanUpper === 'SKIP') {
        setCurrentMode('NORMAL');
        setMessages((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: 'Thik hai! Aap direct shop browse kar sakte hain. Jab bhi coupon mile, yahan daal dijiyega.',
          },
        ]);
        return;
      }

      // CASE 6: Scanned Code / Real Coupon check
      if (cleanUpper.includes('KOKO') || cleanUpper.includes('CRUNCH') || cleanUpper.length >= 4) {
        setScannedCode(query);
        setMessages((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: `🍿 Aapne packet/box scan kiya hai! Code: **${query}**\nCoins claim karne ke liye pehle **Login** ya **Register** karo — uske baad automatically claim ho jayega.`,
            options: ['Login', 'Register', 'Skip'],
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: 'Ye coupon code valid nahi mila. Phir try karo, ya *SKIP* likho.',
          },
        ]);
      }
    }, 400);
  };

  // URL Auto-open & QR Link Parameter Handler
  useEffect(() => {
    const couponParam = searchParams.get('coupon') || searchParams.get('code');

    if (couponParam && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      setIsOpen(true);
      setScannedCode(couponParam);

      // Input me automatically type aur trigger karein
      const codeMsg = couponParam.toUpperCase();
      setInput(codeMsg);

      setTimeout(() => {
        handleSend(codeMsg);

        // Address bar se query clean karein
        const params = new URLSearchParams(searchParams.toString());
        params.delete('coupon');
        params.delete('code');
        const cleanUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
        router.replace(cleanUrl, { scroll: false });
      }, 500);
    }
  }, [searchParams, pathname, router]);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Floating Toggle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-amber-600 hover:bg-amber-700 text-white p-4 rounded-full shadow-2xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
        >
          💬
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-stone-200 flex flex-col h-[500px] overflow-hidden">
          {/* Header */}
          <div className="bg-amber-700 text-white px-4 py-3 flex justify-between items-center">
            <span className="font-semibold text-sm">koko chatbot 🍿</span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-white hover:text-stone-200 text-lg leading-none"
            >
              ✕
            </button>
          </div>

          {/* Messages Container */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-stone-50 text-sm">
            {messages.map((msg, index) => (
              <div key={index} className="space-y-2">
                <div
                  className={`p-3 rounded-2xl max-w-[85%] whitespace-pre-line ${
                    msg.sender === 'user'
                      ? 'ml-auto bg-blue-600 text-white rounded-br-none'
                      : 'mr-auto bg-white border border-stone-200 text-stone-800 rounded-bl-none shadow-sm'
                  }`}
                >
                  {msg.text}
                </div>

                {/* Login / Register / Skip Interactive Buttons */}
                {msg.options && (
                  <div className="flex gap-2 flex-wrap">
                    {msg.options.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleSend(opt)}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-sm transition-all"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Message Input Box */}
          <div className="p-3 border-t border-stone-200 bg-white flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={
                currentMode === 'AWAITING_LOGIN'
                  ? 'Enter email, password...'
                  : currentMode === 'AWAITING_REGISTER'
                  ? 'Enter name, email, password...'
                  : 'Type a message...'
              }
              className="flex-1 border border-stone-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-600"
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

