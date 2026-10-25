const loginAttempts = new Map();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const WINDOW_DURATION_MS = 5 * 60 * 1000;   // 5 minutes
const TARPIT_DELAY_MS = 1000;               // 1 second artificial throttle

export function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "127.0.0.1";
}

export function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return { allowed: true };

  // Check if locked out
  if (entry.lockedUntil && entry.lockedUntil > now) {
    const remainingSec = Math.ceil((entry.lockedUntil - now) / 1000);
    const remainingMin = Math.ceil(remainingSec / 60);
    return {
      allowed: false,
      remainingSec,
      remainingMin,
      error: `Security Lockout: 5 failed attempts reached. Please wait ${remainingMin} minute(s) before trying again.`
    };
  }

  // If lockout or attempt window has expired, reset
  if (now - entry.lastAttempt > WINDOW_DURATION_MS && (!entry.lockedUntil || entry.lockedUntil <= now)) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

export async function recordFailedLogin(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);

  if (!entry || (now - entry.lastAttempt > WINDOW_DURATION_MS && !entry.lockedUntil)) {
    entry = { attempts: 0, lockedUntil: 0, lastAttempt: now };
  }

  entry.attempts += 1;
  entry.lastAttempt = now;

  if (entry.attempts >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
    console.warn(`[Security] IP ${ip} reached ${MAX_FAILED_ATTEMPTS} failed login attempts. Locked out for 15 minutes.`);
  } else {
    console.warn(`[Security] Failed login attempt ${entry.attempts}/${MAX_FAILED_ATTEMPTS} for IP: ${ip}`);
  }

  loginAttempts.set(ip, entry);

  // Tarpit delay: force 1 second wait to stop automated speed brute-force
  await new Promise(r => setTimeout(r, TARPIT_DELAY_MS));
}

export function recordSuccessfulLogin(ip) {
  loginAttempts.delete(ip);
}

export function clearAllLockouts() {
  loginAttempts.clear();
  console.log("[Security] All IP lockouts cleared.");
}

// Periodic cleanup every 10 minutes to keep memory at 0 KB
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts.entries()) {
    if ((!entry.lockedUntil || entry.lockedUntil <= now) && (now - entry.lastAttempt > WINDOW_DURATION_MS)) {
      loginAttempts.delete(ip);
    }
  }
}, 10 * 60 * 1000);
