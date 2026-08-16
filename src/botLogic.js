import supabase from './supabase.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SIGNUP_BONUS = 50;
const DAILY_BONUS = 10;
const QUIZ_COIN_PER_ANSWER = 5;
const DAILY_COOLDOWN_HOURS = 24;

const QUIZ_QUESTIONS = [
  {
    q: '1️⃣ What is the capital of India?\nA) Mumbai\nB) New Delhi\nC) Kolkata\nD) Chennai',
    answer: 'B',
  },
  {
    q: '2️⃣ Which gas do plants absorb from the air for photosynthesis?\nA) Oxygen\nB) Nitrogen\nC) Carbon Dioxide\nD) Hydrogen',
    answer: 'C',
  },
  {
    q: '3️⃣ How many continents are there on Earth?\nA) 5\nB) 6\nC) 7\nD) 8',
    answer: 'C',
  },
  {
    q: '4️⃣ What is the chemical formula for water?\nA) H2O\nB) O2\nC) CO2\nD) NaCl',
    answer: 'A',
  },
  {
    q: '5️⃣ Who wrote the Indian National Anthem?\nA) Mahatma Gandhi\nB) Rabindranath Tagore\nC) Bankim Chandra Chattopadhyay\nD) Sarojini Naidu',
    answer: 'B',
  },
];

// ---------------------------------------------------------------------------
// Data access helpers
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

// Atomic +/- coins via the add_user_coins() Postgres function (see schema.sql)
// so a fast double-tap (e.g. two quiz answers arriving close together) can't
// race the balance. Also writes the transactions audit row in the same call.
async function addCoins(userId, amount, type, description = null) {
  const { data, error } = await supabase.rpc('add_user_coins', {
    p_user_id: userId,
    p_amount: amount,
    p_type: type,
    p_description: description,
  });
  if (error) throw error;
  return data; // new balance
}

async function markSignupBonusClaimed(userId) {
  const { error } = await supabase.from('users').update({ signup_bonus_claimed: true }).eq('id', userId);
  if (error) throw error;
}

async function updateLastDaily(userId) {
  const { error } = await supabase
    .from('users')
    .update({ last_daily_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

// Quiz progress is persisted on the user row (not in-memory) because Render's
// free tier can restart/redeploy the process mid-conversation — an in-memory
// Map would silently drop the user's quiz progress.
async function setQuizState(userId, quizState) {
  const { error } = await supabase.from('users').update({ quiz_state: quizState }).eq('id', userId);
  if (error) throw error;
}

async function clearQuizState(userId) {
  await setQuizState(userId, null);
}

// ---------------------------------------------------------------------------
// Reply builders
// ---------------------------------------------------------------------------
function helpText() {
  return (
    `🤖 *Commands*\n` +
    `• *!balance* — check your coin balance\n` +
    `• *!daily* — claim your daily +${DAILY_BONUS} coins\n` +
    `• *!quiz* — play a 5-question quiz (+${QUIZ_COIN_PER_ANSWER} coins per correct answer)`
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
  return `👋 Hi again!\n\n${helpText()}`;
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
  const state = user.quiz_state;
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
// Main dispatcher — called once per inbound WhatsApp message
// ---------------------------------------------------------------------------
export async function handleMessage(phone, rawText) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();
  const user = await getOrCreateUser(phone);

  // An in-progress quiz owns the conversation until it's finished,
  // so any non-command text is treated as a quiz answer.
  if (user.quiz_state && lower !== '!quiz') {
    return handleQuizAnswer(user, text);
  }

  if (lower === 'hi' || lower === 'hello' || lower === 'hey') {
    return handleGreeting(user);
  }

  switch (lower) {
    case '!balance':
      return `💰 Your balance: *${user.coins} coins*`;
    case '!daily':
      return handleDailyCheckin(user);
    case '!quiz':
      return startQuiz(user);
    default:
      return `🤔 Sorry, I didn't understand that.\n\n${helpText()}`;
  }
}
