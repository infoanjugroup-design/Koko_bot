import supabase from './supabase.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SIGNUP_BONUS = 50;
const DAILY_BONUS = 10;
const QR_CLAIM_BONUS = 50;
const QUIZ_COIN_PER_ANSWER = 5;
const QUIZ_JACKPOT_BONUS = 20;
const DAILY_COOLDOWN_HOURS = 24;

const QUIZ_QUESTIONS = [
  {
    q: '1️⃣ *What is the capital of India?*\nA) Mumbai\nB) New Delhi\nC) Kolkata\nD) Chennai',
    answer: 'B',
  },
  {
    q: '2️⃣ *Which gas do plants absorb from the air for photosynthesis?*\nA) Oxygen\nB) Nitrogen\nC) Carbon Dioxide\nD) Hydrogen',
    answer: 'C',
  },
  {
    q: '3️⃣ *How many continents are there on Earth?*\nA) 5\nB) 6\nC) 7\nD) 8',
    answer: 'C',
  },
  {
    q: '4️⃣ *What is the chemical formula for water?*\nA) H2O\nB) O2\nC) CO2\nD) NaCl',
    answer: 'A',
  },
  {
    q: '5️⃣ *Who wrote the Indian National Anthem?*\nA) Mahatma Gandhi\nB) Rabindranath Tagore\nC) Bankim Chandra Chattopadhyay\nD) Sarojini Naidu',
    answer: 'B',
  },
];

// ---------------------------------------------------------------------------
// DB Helpers
// ---------------------------------------------------------------------------
async function getOrCreateUser(phone) {
  const { data: existing, error: selectError } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert({ phone })
    .select('*')
    .single();

  if (insertError) throw insertError;
  return created;
}

async function addCoins(userId, amount, type, description = null) {
  const { data, error } = await supabase.rpc('add_user_coins', {
    p_user_id: userId,
    p_amount: amount,
    p_type: type,
    p_description: description,
  });
  if (error) throw error;
  return data;
}

async function markSignupBonusClaimed(userId) {
  const { error } = await supabase
    .from('users')
    .update({ signup_bonus_claimed: true })
    .eq('id', userId);
  if (error) throw error;
}

async function updateLastDaily(userId) {
  const { error } = await supabase
    .from('users')
    .update({ last_daily_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

async function setQuizState(userId, quizState) {
  const { error } = await supabase
    .from('users')
    .update({ quiz_state: quizState })
    .eq('id', userId);
  if (error) throw error;
}

async function clearQuizState(userId) {
  await setQuizState(userId, null);
}

// ---------------------------------------------------------------------------
// QR Handshake Handler
// ---------------------------------------------------------------------------
async function handleQrVerification(phone, text) {
  const uuid = text.split('_')[1]?.trim();

  if (!uuid) {
    return '❌ Invalid QR payload. Please scan the QR code again.';
  }

  const { data: session, error } = await supabase
    .from('qr_verifications')
    .select('*')
    .eq('verification_uuid', uuid)
    .eq('status', 'pending')
    .maybeSingle();

  if (error || !session) {
    return '❌ *Invalid or Expired QR Code!*\nPlease refresh the product screen to get a new QR.';
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await supabase
      .from('qr_verifications')
      .update({ status: 'expired' })
      .eq('verification_uuid', uuid);
    return '⌛ *QR Code Expired!*\nPlease refresh your browser.';
  }

  // Link phone & set verified
  await supabase
    .from('qr_verifications')
    .update({
      status: 'verified',
      whatsapp_phone: phone,
    })
    .eq('verification_uuid', uuid);

  const user = await getOrCreateUser(phone);
  const newBalance = await addCoins(
    user.id,
    QR_CLAIM_BONUS,
    'qr_claim',
    `QR Handshake: ${uuid.slice(0, 8)}`
  );

  return (
    `✅ *Authentication Successful!*\n\n` +
    `🔗 WhatsApp linked with Product Dashboard.\n` +
    `🎉 *+${QR_CLAIM_BONUS} Coins* credited!\n` +
    `💰 Balance: *${newBalance} coins*\n\n` +
    `${helpText()}`
  );
}

// ---------------------------------------------------------------------------
// Builders & Handlers
// ---------------------------------------------------------------------------
function helpText() {
  return (
    `🤖 *Commands*\n` +
    `• *!balance* — check coin balance\n` +
    `• *!daily* — claim daily +${DAILY_BONUS} coins\n` +
    `• *!quiz* — play 5-question quiz (+${QUIZ_COIN_PER_ANSWER} coins/correct)\n` +
    `• *!cancel* — exit ongoing quiz`
  );
}

async function handleGreeting(user) {
  if (!user.signup_bonus_claimed) {
    const newBalance = await addCoins(user.id, SIGNUP_BONUS, 'signup_bonus', 'Welcome bonus');
    await markSignupBonusClaimed(user.id);
    return (
      `👋 Welcome to Koko Coins!\n` +
      `🎉 You've received *+${SIGNUP_BONUS} coins* as a signup bonus.\n` +
      `💰 Balance: *${newBalance} coins*\n\n${helpText()}`
    );
  }

  const { data: latest } = await supabase
    .from('users')
    .select('coins')
    .eq('id', user.id)
    .single();

  return `👋 Hi again!\n💰 Balance: *${latest?.coins ?? user.coins} coins*\n\n${helpText()}`;
}

async function handleDailyCheckin(user) {
  const now = Date.now();
  const last = user.last_daily_at ? new Date(user.last_daily_at).getTime() : 0;
  const hoursSince = (now - last) / (1000 * 60 * 60);

  if (hoursSince < DAILY_COOLDOWN_HOURS) {
    const hoursLeft = Math.ceil(DAILY_COOLDOWN_HOURS - hoursSince);
    return `⏳ You've already checked in today.\nCome back in *${hoursLeft}h* for your next +${DAILY_BONUS} coins.`;
  }

  const newBalance = await addCoins(user.id, DAILY_BONUS, 'daily_checkin', 'Daily check-in');
  await updateLastDaily(user.id);
  return `✅ Daily check-in successful!\n🎉 +${DAILY_BONUS} coins added.\n💰 Balance: *${newBalance} coins*`;
}

async function startQuiz(user) {
  const state = { index: 0, score: 0 };
  await setQuizState(user.id, state);
  return (
    `🧠 Quiz started! Reply with *A*, *B*, *C* or *D*.\n` +
    `Earn +${QUIZ_COIN_PER_ANSWER} coins per correct answer.\n\n${QUIZ_QUESTIONS[0].q}`
  );
}

async function handleQuizAnswer(user, rawText) {
  const state = user.quiz_state || { index: 0, score: 0 };
  const current = QUIZ_QUESTIONS[state.index];
  const answer = rawText.trim().toUpperCase().charAt(0);

  if (!['A', 'B', 'C', 'D'].includes(answer)) {
    return `❓ Please reply with A, B, C or D.\n\n${current.q}`;
  }

  let feedback;
  let balance = user.coins;

  if (answer === current.answer) {
    balance = await addCoins(user.id, QUIZ_COIN_PER_ANSWER, 'quiz_correct', `Quiz Q${state.index + 1}`);
    state.score += 1;
    feedback = `✅ Correct! +${QUIZ_COIN_PER_ANSWER} coins`;
  } else {
    feedback = `❌ Wrong! Correct answer was *${current.answer}*.`;
  }

  state.index += 1;

  if (state.index >= QUIZ_QUESTIONS.length) {
    if (state.score === QUIZ_QUESTIONS.length) {
      balance = await addCoins(user.id, QUIZ_JACKPOT_BONUS, 'quiz_jackpot', 'Perfect Score');
      feedback += `\n🏆 *Jackpot Bonus:* +${QUIZ_JACKPOT_BONUS} extra coins!`;
    }

    await clearQuizState(user.id);
    return (
      `${feedback}\n\n🏁 Quiz complete! Score: *${state.score}/${QUIZ_QUESTIONS.length}*\n` +
      `💰 Balance: *${balance} coins*\n\n${helpText()}`
    );
  }

  await setQuizState(user.id, state);
  return `${feedback}\n\n${QUIZ_QUESTIONS[state.index].q}`;
}

// ---------------------------------------------------------------------------
// Main Dispatcher
// ---------------------------------------------------------------------------
export async function handleMessage(phone, rawText) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  // QR Handshake Trigger
  if (lower.startsWith('verify_') || lower.startsWith('verify ')) {
    const formatted = text.replace('verify ', 'verify_');
    return await handleQrVerification(phone, formatted);
  }

  const user = await getOrCreateUser(phone);

  if (lower === '!cancel' || lower === '!exit') {
    if (user.quiz_state) {
      await clearQuizState(user.id);
      return `🛑 Quiz cancelled.\n\n${helpText()}`;
    }
    return `ℹ️ No active quiz running.\n\n${helpText()}`;
  }

  if (user.quiz_state && lower !== '!quiz') {
    return handleQuizAnswer(user, text);
  }

  if (['hi', 'hello', 'hey', 'start'].includes(lower)) {
    return handleGreeting(user);
  }

  switch (lower) {
    case '!balance':
    case '!coins': {
      const { data: latest } = await supabase
        .from('users')
        .select('coins')
        .eq('id', user.id)
        .single();
      return `💰 Your balance: *${latest?.coins ?? user.coins} coins*`;
    }
    case '!daily':
      return handleDailyCheckin(user);
    case '!quiz':
      return startQuiz(user);
    default:
      return `🤔 Sorry, I didn't understand that.\n\n${helpText()}`;
  }
}
