import supabase from './supabase.js';

// ---------------------------------------------------------------------------
// Config & Economy Parameters
// ---------------------------------------------------------------------------
const SIGNUP_BONUS = 50;
const DAILY_BONUS = 10;
const QR_CLAIM_BONUS = 50;
const QUIZ_COIN_PER_ANSWER = 5;
const QUIZ_JACKPOT_BONUS = 20; // Extra bonus for 5/5 score
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
// Database Access Helpers
// ---------------------------------------------------------------------------
async function getOrCreateUser(phone) {
  const { data: existing, error: selectError } = await supabase
    .from('users')
    .select('*')
    .eq('phone_number', phone)
    .maybeSingle();

  if (selectError) {
    console.error('Error fetching user:', selectError);
    throw selectError;
  }
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert({
      phone_number: phone,
      coins_balance: 0,
      current_flow_step: 'idle',
      quiz_state: null,
      signup_bonus_claimed: false,
    })
    .select('*')
    .single();

  if (insertError) {
    console.error('Error creating user:', insertError);
    throw insertError;
  }
  return created;
}

// Add/Deduct coins safely with RPC or fallback direct database update
async function addCoins(userId, amount, type, description = null) {
  try {
    const { data, error } = await supabase.rpc('add_user_coins', {
      p_user_id: userId,
      p_amount: amount,
      p_type: type,
      p_description: description,
    });

    if (!error && typeof data === 'number') return data;
  } catch (rpcErr) {
    console.warn('RPC add_user_coins failed or not found, falling back to direct table update...');
  }

  // Fallback direct update
  const { data: currentUser } = await supabase
    .from('users')
    .select('coins_balance')
    .eq('id', userId)
    .single();

  const newBalance = (currentUser?.coins_balance || 0) + amount;

  await supabase
    .from('users')
    .update({ coins_balance: newBalance })
    .eq('id', userId);

  await supabase.from('transactions').insert({
    user_id: userId,
    amount: amount,
    type: type,
    description: description,
  });

  return newBalance;
}

async function markSignupBonusClaimed(userId) {
  await supabase
    .from('users')
    .update({ signup_bonus_claimed: true })
    .eq('id', userId);
}

async function updateLastDaily(userId) {
  await supabase
    .from('users')
    .update({ last_checkin: new Date().toISOString() })
    .eq('id', userId);
}

async function setQuizState(userId, quizState) {
  await supabase
    .from('users')
    .update({
      quiz_state: quizState,
      current_flow_step: quizState ? 'in_quiz' : 'idle',
    })
    .eq('id', userId);
}

async function clearQuizState(userId) {
  await setQuizState(userId, null);
}

// ---------------------------------------------------------------------------
// QR Verification & Handshake Logic (New Additive Module)
// ---------------------------------------------------------------------------
async function handleQrVerification(phone, text) {
  const parts = text.split('_');
  const uuid = parts.slice(1).join('_').trim();

  if (!uuid) {
    return '❌ Invalid QR payload. Please rescan the QR code from the screen.';
  }

  // 1. Check if UUID exists and is pending
  const { data: session, error } = await supabase
    .from('qr_verifications')
    .select('*')
    .eq('verification_uuid', uuid)
    .eq('status', 'pending')
    .maybeSingle();

  if (error || !session) {
    return '❌ *Invalid or Expired QR Code!*\nPlease refresh the product dashboard to generate a fresh QR code.';
  }

  // 2. Check Expiry
  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    await supabase
      .from('qr_verifications')
      .update({ status: 'expired' })
      .eq('verification_uuid', uuid);
    return '⌛ *QR Code Expired!*\nPlease refresh your browser dashboard to generate a new QR.';
  }

  // 3. Mark as verified & link sender phone
  await supabase
    .from('qr_verifications')
    .update({
      status: 'verified',
      whatsapp_phone: phone,
    })
    .eq('verification_uuid', uuid);

  // 4. Ensure user exists and credit QR claim bonus
  const user = await getOrCreateUser(phone);
  const updatedBalance = await addCoins(
    user.id,
    QR_CLAIM_BONUS,
    'qr_claim',
    `Verified Web Session: ${uuid.substring(0, 8)}...`
  );

  return (
    `✅ *Authentication Successful!*\n\n` +
    `🔗 Your WhatsApp number (*${phone}*) is now securely connected to the dashboard.\n` +
    `🎉 *+${QR_CLAIM_BONUS} Coins* credited to your wallet!\n` +
    `💰 Current Balance: *${updatedBalance} coins*\n\n` +
    `${helpText()}`
  );
}

// ---------------------------------------------------------------------------
// Response Builders
// ---------------------------------------------------------------------------
function helpText() {
  return (
    `🤖 *Bot Commands Menu*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `• *!balance* — Check your coin balance\n` +
    `• *!daily* — Claim daily free +${DAILY_BONUS} coins\n` +
    `• *!quiz* — Play 5-question quiz (+${QUIZ_COIN_PER_ANSWER} coins/correct)\n` +
    `• *!cancel* — Exit active quiz session\n` +
    `• *!help* — Show this menu`
  );
}

async function handleGreeting(user) {
  if (!user.signup_bonus_claimed) {
    const newBalance = await addCoins(user.id, SIGNUP_BONUS, 'signup_bonus', 'Welcome Signup Bonus');
    await markSignupBonusClaimed(user.id);
    return (
      `👋 *Welcome to Koko Coins Bot!*\n\n` +
      `🎉 You received *+${SIGNUP_BONUS} Coins* as a signup bonus!\n` +
      `💰 Current Balance: *${newBalance} coins*\n\n` +
      `${helpText()}`
    );
  }

  const { data: latest } = await supabase
    .from('users')
    .select('coins_balance')
    .eq('id', user.id)
    .single();

  return (
    `👋 *Welcome back!*\n` +
    `💰 Current Balance: *${latest?.coins_balance ?? user.coins_balance} coins*\n\n` +
    `${helpText()}`
  );
}

async function handleDailyCheckin(user) {
  const now = Date.now();
  const last = user.last_checkin ? new Date(user.last_checkin).getTime() : 0;
  const hoursSince = (now - last) / (1000 * 60 * 60);

  if (hoursSince < DAILY_COOLDOWN_HOURS) {
    const hoursLeft = Math.ceil(DAILY_COOLDOWN_HOURS - hoursSince);
    return `⏳ *Already Claimed!*\nCome back in *${hoursLeft} hours* for your next +${DAILY_BONUS} coins.`;
  }

  const newBalance = await addCoins(user.id, DAILY_BONUS, 'daily_checkin', 'Daily Check-in Reward');
  await updateLastDaily(user.id);
  return `✅ *Daily Check-in Successful!*\n🎉 *+${DAILY_BONUS} coins* credited.\n💰 Current Balance: *${newBalance} coins*`;
}

async function startQuiz(user) {
  const state = { index: 0, score: 0 };
  await setQuizState(user.id, state);
  return (
    `🧠 *Koko Quiz Started!*\n` +
    `Reply with *A*, *B*, *C*, or *D*.\n` +
    `💰 Reward: *+${QUIZ_COIN_PER_ANSWER} coins* per correct answer.\n` +
    `Type *!cancel* anytime to quit.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${QUIZ_QUESTIONS[0].q}`
  );
}

async function handleQuizAnswer(user, rawText) {
  const state = user.quiz_state || { index: 0, score: 0 };
  const current = QUIZ_QUESTIONS[state.index];
  const answer = rawText.trim().toUpperCase().charAt(0);

  if (!['A', 'B', 'C', 'D'].includes(answer)) {
    return `⚠️ Invalid option! Please reply with *A*, *B*, *C*, or *D* (or *!cancel* to quit).\n\n${current.q}`;
  }

  let feedback = '';
  let updatedBalance = user.coins_balance;

  if (answer === current.answer) {
    updatedBalance = await addCoins(user.id, QUIZ_COIN_PER_ANSWER, 'quiz_correct', `Quiz Q${state.index + 1} Correct`);
    state.score += 1;
    feedback = `✅ *Correct!* (+${QUIZ_COIN_PER_ANSWER} coins)`;
  } else {
    feedback = `❌ *Incorrect!* Correct answer was *${current.answer}*.`;
  }

  state.index += 1;

  // Quiz Finished
  if (state.index >= QUIZ_QUESTIONS.length) {
    let jackpotText = '';
    if (state.score === QUIZ_QUESTIONS.length) {
      updatedBalance = await addCoins(user.id, QUIZ_JACKPOT_BONUS, 'quiz_jackpot', 'Perfect Score Jackpot');
      jackpotText = `\n🏆 *Perfect Score Bonus:* +${QUIZ_JACKPOT_BONUS} extra coins!`;
    }

    await clearQuizState(user.id);
    return (
      `${feedback}\n\n` +
      `🏁 *Quiz Completed!*\n` +
      `📊 Score: *${state.score}/${QUIZ_QUESTIONS.length}* correct${jackpotText}\n` +
      `💰 Final Balance: *${updatedBalance} coins*\n\n` +
      `${helpText()}`
    );
  }

  // Next Question
  await setQuizState(user.id, state);
  return `${feedback}\n\n━━━━━━━━━━━━━━━━━━━━\n${QUIZ_QUESTIONS[state.index].q}`;
}

// ---------------------------------------------------------------------------
// Main Message Router
// ---------------------------------------------------------------------------
export async function handleMessage(phone, rawText) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  // 1. QR Code / UUID Verification Intercept
  if (lower.startsWith('verify_') || lower.startsWith('verify ')) {
    const formattedText = text.replace('verify ', 'verify_');
    return await handleQrVerification(phone, formattedText);
  }

  const user = await getOrCreateUser(phone);

  // 2. Active Quiz Cancellation
  if (lower === '!cancel' || lower === '!exit') {
    if (user.quiz_state) {
      await clearQuizState(user.id);
      return `🛑 Quiz session cancelled.\n\n${helpText()}`;
    }
    return `ℹ️ No active quiz session running.\n\n${helpText()}`;
  }

  // 3. In-Progress Quiz Handler (Blocks normal commands except !cancel)
  if (user.quiz_state && lower !== '!quiz') {
    return handleQuizAnswer(user, text);
  }

  // 4. Greeting & Onboarding
  if (['hi', 'hello', 'hey', 'start'].includes(lower)) {
    return handleGreeting(user);
  }

  // 5. Standard Bot Commands
  switch (lower) {
    case '!balance':
    case '!coins': {
      const { data: latest } = await supabase
        .from('users')
        .select('coins_balance')
        .eq('id', user.id)
        .single();
      const currentCoins = latest?.coins_balance ?? user.coins_balance ?? 0;
      return `💰 Your current wallet balance: *${currentCoins} coins*`;
    }
    case '!daily':
      return handleDailyCheckin(user);
    case '!quiz':
      return startQuiz(user);
    case '!help':
    case '!menu':
      return helpText();
    default:
      return `🤔 Sorry, I didn't understand that command.\n\n${helpText()}`;
  }
}
